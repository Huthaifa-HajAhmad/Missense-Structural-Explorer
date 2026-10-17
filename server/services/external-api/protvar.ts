/**
 * EBI ProtVar's precomputed FoldX ΔΔG, on the AlphaFold DB model of the canonical UniProt sequence.
 *
 *   GET https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/{accession}/{position}
 *   → [{ proteinAcc, position, afId: "F1", afPos, wildType, mutatedType, foldxDdg, plddt, … }, …]
 *
 * WHAT IT IS, AND WHAT IT IS NOT. It is FoldX — the same force field this app runs locally — applied
 * by EBI to the AlphaFold model. It is therefore a REFERENCE value (a cross-check on the template, and
 * the only FoldX number available when the local run cannot finish), never a second vote in the
 * engine agreement: counting it beside local FoldX would count one method twice.
 *
 * WHY SEVERAL ROWS CAN ANSWER ONE SUBSTITUTION. Proteins longer than ~2,700 residues are modelled by
 * AlphaFold DB as overlapping fragments (TTN position 20000 sits in F94 and F100, among others), and
 * each fragment yields its own ΔΔG — measured at +2.11 and +3.22 kcal/mol for the same G→A. Choosing
 * one would report a model nobody selected, so fragments that disagree are reported as such and no
 * value is returned.
 */
import { LRUCache } from "lru-cache";
import { defaultCacheRegistry } from "../infra/cache.ts";
import { fetchWithRetry } from "../infra/http-client.ts";

export type ProtVarFoldxOutcome =
  | {
      status: "found";
      /** ΔΔG in kcal/mol, FoldX sign convention (positive = destabilizing). */
      ddg: number;
      /** AlphaFold pLDDT at this residue in the model FoldX ran on. */
      plddt: number | null;
      /** The AlphaFold DB model, e.g. `AF-P15056-F1`. */
      model: string;
    }
  | { status: "absent"; reason: string };

/** Two fragment ΔΔGs closer than this are the same answer at the precision anyone reads. */
const FRAGMENT_AGREEMENT_KCAL = 0.05;

/** Precomputed and versioned with AlphaFold DB, so a month is conservative. */
const protvarFoldxCache = new LRUCache<string, ProtVarFoldxOutcome>({
  max: 2_000,
  ttl: 30 * 24 * 60 * 60 * 1000,
});
defaultCacheRegistry.registerCache("protvarFoldxCache", protvarFoldxCache, { ttlDesc: "30d" });

interface ProtVarFoldxEntry {
  position?: number;
  afId?: string;
  wildType?: string;
  mutatedType?: string;
  foldxDdg?: number;
  plddt?: number;
}

/**
 * ProtVar's FoldX ΔΔG for one substitution on the canonical sequence, or why there is none.
 *
 * Throws when ProtVar cannot be reached (an outage is not a fact about the variant); a 404 or an
 * empty answer is `absent`. `position` must be CANONICAL UniProt numbering, which is what the
 * analysis pipeline verifies before any engine runs.
 */
export async function fetchProtVarFoldx(
  uniprotId: string,
  position: number,
  wt1: string,
  mut1: string,
  signal?: AbortSignal
): Promise<ProtVarFoldxOutcome> {
  const accession = uniprotId.trim().toUpperCase().split("-")[0];
  const wt = wt1.trim().toUpperCase();
  const mut = mut1.trim().toUpperCase();
  const key = `${accession}:${position}:${wt}>${mut}`;
  const cached = protvarFoldxCache.get(key);
  if (cached) return cached;

  const response = await fetchWithRetry(
    `https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/${encodeURIComponent(accession)}/${position}`,
    { headers: { Accept: "application/json" }, timeout: 10_000, ...(signal ? { signal } : {}) },
    2
  );
  if (response.status === 404) {
    return remember(key, { status: "absent", reason: `ProtVar has no FoldX predictions for ${accession} position ${position}` });
  }
  if (!response.ok) throw new Error(`ProtVar answered HTTP ${response.status}`);

  const entries = ((await response.json()) as ProtVarFoldxEntry[] | null) ?? [];
  const rows = (Array.isArray(entries) ? entries : []).filter(
    (e) =>
      e?.position === position &&
      String(e?.mutatedType ?? "").toUpperCase() === mut &&
      typeof e?.foldxDdg === "number" &&
      Number.isFinite(e.foldxDdg)
  );
  if (rows.length === 0) {
    return remember(key, { status: "absent", reason: `ProtVar has no FoldX prediction for ${wt}${position}${mut}` });
  }

  // ProtVar numbers the canonical sequence; a different wild type means the two are not describing
  // the same residue, and a value for it would be a value for another variant.
  if (rows.some(e => typeof e.wildType !== "string" || !e.wildType.trim())) {
    // Missing identity is a malformed response, not evidence that this variant is absent.
    // Throw so it is reported as a provider error and is not cached as a month-long absence.
    throw new Error("ProtVar did not report the reference residue, so the FoldX prediction cannot be verified.");
  }
  const otherWt = rows.find((e) => String(e.wildType ?? "").toUpperCase() !== wt);
  if (otherWt) {
    return remember(key, {
      status: "absent",
      reason: `ProtVar's residue ${position} is ${String(otherWt.wildType).toUpperCase()}, not ${wt}`,
    });
  }

  const ddgs = rows.map((e) => e.foldxDdg as number);
  if (Math.max(...ddgs) - Math.min(...ddgs) > FRAGMENT_AGREEMENT_KCAL) {
    const models = rows.map((e) => `${e.afId} ${(e.foldxDdg as number) >= 0 ? "+" : ""}${(e.foldxDdg as number).toFixed(2)}`);
    return remember(key, {
      status: "absent",
      reason: `ProtVar's AlphaFold fragment models disagree at this residue (${models.join(", ")} kcal/mol), so no single value is reported`,
    });
  }

  const first = rows[0];
  return remember(key, {
    status: "found",
    ddg: first.foldxDdg as number,
    plddt: typeof first.plddt === "number" && Number.isFinite(first.plddt) ? first.plddt : null,
    model: `AF-${accession}-${first.afId ?? "F1"}`,
  });
}

function remember(key: string, outcome: ProtVarFoldxOutcome): ProtVarFoldxOutcome {
  protvarFoldxCache.set(key, outcome);
  return outcome;
}

/**
 * The run fields a ProtVar lookup writes, in one place, so the queue companion, the cache-hit path
 * and the poll merge cannot drift into carrying different subsets (the whitelist failure
 * `enrichBiophysicalResult` documents for the repair flags).
 */
// A type alias, not an interface, so it is assignable to the queue's `Record<string, unknown>` updates.
export type ProtVarJobFields = {
  protvarStatus: "done" | "error";
  protvarVal: number | null;
  protvarPlddt: number | null;
  protvarModel: string | null;
  protvarReason: string | null;
  protvarError: string | null;
};

export function protvarJobFields(outcome: ProtVarFoldxOutcome): ProtVarJobFields {
  return outcome.status === "found"
    ? { protvarStatus: "done", protvarVal: outcome.ddg, protvarPlddt: outcome.plddt, protvarModel: outcome.model, protvarReason: null, protvarError: null }
    : { protvarStatus: "done", protvarVal: null, protvarPlddt: null, protvarModel: null, protvarReason: outcome.reason, protvarError: null };
}

export function protvarErrorFields(err: unknown): ProtVarJobFields {
  return {
    protvarStatus: "error",
    protvarVal: null,
    protvarPlddt: null,
    protvarModel: null,
    protvarReason: null,
    protvarError: (err as any)?.message ?? "ProtVar lookup failed",
  };
}

/** ProtVar's reading of one GRCh38 SNV on a gene's canonical UniProt isoform, or why there is none. */
export type ProtVarCoordinateMapping =
  | {
      status: "found";
      gene: string;
      /** Canonical UniProt accession; `position` is numbered on it. */
      accession: string;
      position: number;
      /** Single-letter wild type and mutant. */
      wt: string;
      mut: string;
    }
  | { status: "absent"; reason: string };

const THREE_TO_ONE: Record<string, string> = {
  Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I",
  Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V",
};

interface ProtVarMappingIsoform {
  accession?: string;
  canonical?: boolean;
  isoformPosition?: number;
  refAA?: string;
  variantAA?: string;
}

/**
 * ProtVar's mapping of a GRCh38 SNV (`GET /ProtVar/api/mapping?q=chr-pos-ref-alt`), read on the
 * canonical isoform only. This is the same numbering the analysis pipeline verifies against.
 *
 * Only a missense change on exactly one gene's canonical isoform is `found`. A change that is
 * synonymous on the canonical protein is `absent`, not "not missense": in the concordance study
 * (doc/RESOLVER_CONCORDANCE.md) every such case was missense on a non-canonical transcript, which is
 * a question for the other rungs. Two genes answering is also `absent`, because one record cannot
 * carry that ambiguity. Throws on transport failure, since an outage is not a fact about the variant.
 */
export async function fetchProtVarCoordinateMapping(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  signal?: AbortSignal
): Promise<ProtVarCoordinateMapping> {
  const query = `${chrom.replace(/^chr/i, "")}-${pos}-${ref.toUpperCase()}-${alt.toUpperCase()}`;
  const response = await fetchWithRetry(
    `https://www.ebi.ac.uk/ProtVar/api/mapping?q=${encodeURIComponent(query)}&assembly=GRCh38`,
    { headers: { Accept: "application/json" }, timeout: 10_000, ...(signal ? { signal } : {}) },
    1
  );
  if (!response.ok) throw new Error(`ProtVar mapping answered HTTP ${response.status}`);
  const body = (await response.json()) as any;

  const readings: Array<Extract<ProtVarCoordinateMapping, { status: "found" }>> = [];
  for (const input of body?.content?.inputs ?? []) {
    for (const derived of input?.derivedGenomicVariants ?? []) {
      for (const gene of derived?.genes ?? []) {
        for (const iso of (gene?.isoforms ?? []) as ProtVarMappingIsoform[]) {
          const wt = THREE_TO_ONE[iso.refAA ?? ""];
          const mut = THREE_TO_ONE[iso.variantAA ?? ""];
          if (!iso.canonical || !wt || !mut || typeof iso.isoformPosition !== "number" || !iso.accession) continue;
          if (wt === mut) continue; // synonymous on the canonical protein
          readings.push({ status: "found", gene: String(gene.geneName ?? ""), accession: iso.accession, position: iso.isoformPosition, wt, mut });
        }
      }
    }
  }
  const distinct = new Map(readings.map(r => [`${r.gene}|${r.accession}|${r.position}|${r.wt}>${r.mut}`, r]));
  if (distinct.size === 1) return [...distinct.values()][0];
  return {
    status: "absent",
    reason: distinct.size === 0
      ? "ProtVar reports no missense change on a canonical isoform at this coordinate"
      : `ProtVar reports ${distinct.size} canonical readings (more than one gene), so none is chosen`,
  };
}
