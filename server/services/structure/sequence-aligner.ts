import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import { fetchWithRetry } from "../infra/http-client.ts";

// Standard BLOSUM62 substitution matrix for amino acid alignment
const BLOSUM62_ORDER = "ARNDCQEGHILKMFPSTWYVBZX*";
const BLOSUM62_MATRIX: number[][] = [
  /* A */ [ 4, -1, -2, -2,  0, -1, -1,  0, -2, -1, -1, -1, -1, -2, -1,  1,  0, -3, -2,  0, -2, -1,  0, -4],
  /* R */ [-1,  5,  0, -2, -3,  1,  0, -2,  0, -3, -2,  2, -1, -3, -2, -1, -1, -3, -2, -3, -1,  0, -1, -4],
  /* N */ [-2,  0,  6,  1, -3,  0,  0,  0,  1, -3, -3,  0, -2, -3, -2,  1,  0, -4, -2, -3,  3,  0, -1, -4],
  /* D */ [-2, -2,  1,  6, -3,  0,  2, -1, -1, -3, -4, -1, -3, -3, -1,  0, -1, -4, -3, -3,  4,  1, -1, -4],
  /* C */ [ 0, -3, -3, -3,  9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1, -3, -3, -2, -4],
  /* Q */ [-1,  1,  0,  0, -3,  5,  2, -2,  0, -3, -2,  1,  0, -3, -1,  0, -1, -2, -1, -2,  0,  3, -1, -4],
  /* E */ [-1,  0,  0,  2, -4,  2,  5, -2,  0, -3, -3,  1, -2, -3, -1,  0, -1, -3, -2, -2,  1,  4, -1, -4],
  /* G */ [ 0, -2,  0, -1, -3, -2, -2,  6, -2, -4, -4, -2, -3, -3, -2,  0, -2, -2, -3, -3, -1, -2, -1, -4],
  /* H */ [-2,  0,  1, -1, -3,  0,  0, -2,  8, -3, -3, -1, -2, -1, -2, -1, -2, -2,  2, -3,  0,  0, -1, -4],
  /* I */ [-1, -3, -3, -3, -1, -3, -3, -4, -3,  4,  2, -3,  1,  0, -3, -2, -1, -3, -1,  3, -3, -3, -1, -4],
  /* L */ [-1, -2, -3, -4, -1, -2, -3, -4, -3,  2,  4, -2,  2,  0, -3, -2, -1, -2, -1,  1, -4, -3, -1, -4],
  /* K */ [-1,  2,  0, -1, -3,  1,  1, -2, -1, -3, -2,  5, -1, -3, -1,  0, -1, -3, -2, -2,  0,  1, -1, -4],
  /* M */ [-1, -1, -2, -3, -1,  0, -2, -3, -2,  1,  2, -1,  5,  0, -2, -1, -1, -1, -1,  1, -3, -1, -1, -4],
  /* F */ [-2, -3, -3, -3, -2, -3, -3, -3, -1,  0,  0, -3,  0,  6, -4, -2, -2,  1,  3, -1, -3, -3, -1, -4],
  /* P */ [-1, -2, -2, -1, -3, -1, -1, -2, -2, -3, -3, -1, -2, -4,  7, -1, -1, -4, -3, -2, -2, -1, -2, -4],
  /* S */ [ 1, -1,  1,  0, -1,  0,  0,  0, -1, -2, -2,  0, -1, -2, -1,  4,  1, -3, -2, -2,  0,  0,  0, -4],
  /* T */ [ 0, -1,  0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -2, -1,  1,  5, -2, -2,  0, -1, -1,  0, -4],
  /* W */ [-3, -3, -4, -4, -2, -2, -3, -2, -2, -3, -2, -3, -1,  1, -4, -3, -2, 11,  2, -3, -4, -3, -2, -4],
  /* Y */ [-2, -2, -2, -3, -2, -1, -2, -3,  2, -1, -1, -2, -1,  3, -3, -2, -2,  2,  7, -1, -3, -2, -1, -4],
  /* V */ [ 0, -3, -3, -3, -1, -2, -2, -3, -3,  3,  1, -2,  1, -1, -2, -2,  0, -3, -1,  4, -3, -2, -1, -4],
  /* B */ [-2, -1,  3,  4, -3,  0,  1, -1,  0, -3, -4,  0, -3, -3, -2,  0, -1, -4, -3, -3,  4,  1, -1, -4],
  /* Z */ [-1,  0,  0,  1, -3,  3,  4, -2,  0, -3, -3,  1, -1, -3, -1,  0, -1, -3, -2, -2,  1,  4, -1, -4],
  /* X */ [ 0, -1, -1, -1, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -2,  0,  0, -2, -1, -1, -1, -1, -1, -4],
  /* * */ [-4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4,  1]
];

function getBlosum62Score(a: string, b: string): number {
  const i = BLOSUM62_ORDER.indexOf(a.toUpperCase());
  const j = BLOSUM62_ORDER.indexOf(b.toUpperCase());
  const idxA = i !== -1 ? i : BLOSUM62_ORDER.indexOf("X");
  const idxB = j !== -1 ? j : BLOSUM62_ORDER.indexOf("X");
  return BLOSUM62_MATRIX[idxA][idxB];
}

export interface PdbResidueItem {
  resSeq: number;
  insCode: string;
  resName3: string;
  resName1: string;
}

export interface PdbChainExtraction {
  sequence: string;
  residues: PdbResidueItem[];
}

/**
 * Modified amino acids that crystallographers deposit as HETATM inside the polymer, with the residue
 * they stand for. Without them a selenomethionine (MSE) chain aligns with a gap at every Met, and its
 * MSE residues keep the authors' numbering while the rest of the chain is renumbered around them.
 */
export const MODIFIED_RESIDUE_PARENT: Record<string, string> = {
  MSE: "M", SEP: "S", TPO: "T", PTR: "Y", CSO: "C", CSD: "C", CME: "C", OCS: "C",
  KCX: "K", MLY: "K", M3L: "K", ALY: "K", HYP: "P", NEP: "H",
};

const WATER_RESIDUES = new Set(["HOH", "WAT", "DOD", "H2O"]);

/**
 * Extracts unique amino acid residues and 1-letter sequence from PDB ATOM lines for a target chain,
 * with the modified residues of `MODIFIED_RESIDUE_PARENT` read as their parent amino acid.
 */
export function extractPdbChainSequence(pdbText: string, chainId: string): PdbChainExtraction {
  const lines = pdbText.split("\n");
  const targetChain = chainId.trim().toUpperCase();
  const residues: PdbResidueItem[] = [];
  let lastKey = "";

  for (const line of lines) {
    const polymerHet = line.startsWith("HETATM") && !!MODIFIED_RESIDUE_PARENT[line.substring(17, 20).trim().toUpperCase()];
    if (line.startsWith("ATOM") || polymerHet) {
      const lineChain = line.length > 21 ? line.charAt(21).toUpperCase() : "";
      if (lineChain === targetChain) {
        const resSeqStr = line.substring(22, 26).trim();
        const insCode = line.length > 26 ? line.charAt(26).trim() : "";
        const resName3 = line.substring(17, 20).trim().toUpperCase();
        const resSeq = parseInt(resSeqStr, 10);
        if (isNaN(resSeq)) continue;

        const key = `${resSeq}_${insCode}`;
        if (key !== lastKey) {
          lastKey = key;
          const formatted3 = resName3.charAt(0).toUpperCase() + resName3.slice(1).toLowerCase();
          const resName1 = AMINO_ACID_3_TO_1[formatted3] || MODIFIED_RESIDUE_PARENT[resName3] || (resName3.length === 1 ? resName3 : "X");
          residues.push({ resSeq, insCode, resName3, resName1 });
        }
      }
    }
  }

  const sequence = residues.map(r => r.resName1).join("");
  return { sequence, residues };
}

export interface AlignmentResult {
  alignedPdb: string;
  alignedUniprot: string;
  score: number;
  identity: number;
  /** Maps PDB residue index in PdbChainExtraction.residues array -> 1-based UniProt position */
  pdbIndexToUniprotPosMap: Map<number, number>;
  /** Maps 1-based UniProt position -> PdbResidueItem */
  uniprotPosToPdbResidueMap: Map<number, PdbResidueItem>;
}

export const MAX_ALIGNMENT_LENGTH = 3000;

/**
 * Needleman-Wunsch Global Alignment with affine gap penalties.
 * Optimized with flat 1D Float32Array memory layout and length safety guard.
 */
export function alignNeedlemanWunsch(
  pdbExtraction: PdbChainExtraction,
  uniprotSequence: string,
  gapOpen = -10,
  gapExtend = -1
): AlignmentResult {
  const s1 = pdbExtraction.sequence;
  const s2 = uniprotSequence;
  const n = s1.length;
  const m = s2.length;

  if (n === 0 || m === 0) {
    return {
      alignedPdb: "",
      alignedUniprot: "",
      score: 0,
      identity: 0,
      pdbIndexToUniprotPosMap: new Map(),
      uniprotPosToPdbResidueMap: new Map()
    };
  }

  // Safety guard against massive sequences (e.g. Titin) causing OOM or event loop lockup
  if (n > MAX_ALIGNMENT_LENGTH || m > MAX_ALIGNMENT_LENGTH) {
    console.warn(`[Needleman-Wunsch Alignment Guard] Sequence size (${n}x${m}) exceeds max threshold (${MAX_ALIGNMENT_LENGTH}). Falling back to canonical structure.`);
    return {
      alignedPdb: "",
      alignedUniprot: "",
      score: 0,
      identity: 0,
      pdbIndexToUniprotPosMap: new Map(),
      uniprotPosToPdbResidueMap: new Map()
    };
  }

  // DP Matrices in flat 1D Float32Array for optimal cache locality and zero GC pressure
  const stride = m + 1;
  const totalCells = (n + 1) * stride;
  const NEG_INF = -1e9;

  const M = new Float32Array(totalCells);
  const X = new Float32Array(totalCells);
  const Y = new Float32Array(totalCells);

  M.fill(NEG_INF);
  X.fill(NEG_INF);
  Y.fill(NEG_INF);

  M[0] = 0;
  for (let i = 1; i <= n; i++) {
    X[i * stride] = gapOpen + i * gapExtend;
  }
  for (let j = 1; j <= m; j++) {
    Y[j] = gapOpen + j * gapExtend;
  }

  for (let i = 1; i <= n; i++) {
    const rowOffset = i * stride;
    const prevRowOffset = (i - 1) * stride;
    const char1 = s1[i - 1];

    for (let j = 1; j <= m; j++) {
      const matchScore = getBlosum62Score(char1, s2[j - 1]);
      const prevDiagIdx = prevRowOffset + (j - 1);
      const currIdx = rowOffset + j;

      M[currIdx] = Math.max(M[prevDiagIdx], X[prevDiagIdx], Y[prevDiagIdx]) + matchScore;
      X[currIdx] = Math.max(M[prevRowOffset + j] + gapOpen + gapExtend, X[prevRowOffset + j] + gapExtend);
      Y[currIdx] = Math.max(M[rowOffset + (j - 1)] + gapOpen + gapExtend, Y[rowOffset + (j - 1)] + gapExtend);
    }
  }

  // Traceback
  let i = n;
  let j = m;
  let currentMatrix: "M" | "X" | "Y" = "M";
  const endIdx = n * stride + m;
  let maxScore = M[endIdx];
  if (X[endIdx] > maxScore) { maxScore = X[endIdx]; currentMatrix = "X"; }
  if (Y[endIdx] > maxScore) { maxScore = Y[endIdx]; currentMatrix = "Y"; }

  const align1Arr: string[] = [];
  const align2Arr: string[] = [];
  const pdbIndexToUniprot = new Map<number, number>();
  const uniprotToPdbResidue = new Map<number, PdbResidueItem>();

  let matches = 0;
  let alignedLength = 0;

  while (i > 0 || j > 0) {
    const currIdx = i * stride + j;
    if (currentMatrix === "M") {
      align1Arr.push(s1[i - 1]);
      align2Arr.push(s2[j - 1]);
      if (s1[i - 1] === s2[j - 1]) matches++;
      alignedLength++;

      pdbIndexToUniprot.set(i - 1, j);
      uniprotToPdbResidue.set(j, pdbExtraction.residues[i - 1]);

      const prevScore = getBlosum62Score(s1[i - 1], s2[j - 1]);
      const prevDiagIdx = (i - 1) * stride + (j - 1);
      const prevM = M[prevDiagIdx];
      const prevX = X[prevDiagIdx];
      const prevY = Y[prevDiagIdx];
      const targetVal = M[currIdx] - prevScore;

      if (Math.abs(targetVal - prevM) < 1e-4) currentMatrix = "M";
      else if (Math.abs(targetVal - prevX) < 1e-4) currentMatrix = "X";
      else currentMatrix = "Y";

      i--;
      j--;
    } else if (currentMatrix === "X") {
      align1Arr.push(s1[i - 1]);
      align2Arr.push("-");
      alignedLength++;

      const prevRowIdx = (i - 1) * stride + j;
      if (Math.abs(X[currIdx] - (X[prevRowIdx] + gapExtend)) < 1e-4) {
        currentMatrix = "X";
      } else {
        currentMatrix = "M";
      }
      i--;
    } else {
      align1Arr.push("-");
      align2Arr.push(s2[j - 1]);
      alignedLength++;

      const prevColIdx = i * stride + (j - 1);
      if (Math.abs(Y[currIdx] - (Y[prevColIdx] + gapExtend)) < 1e-4) {
        currentMatrix = "Y";
      } else {
        currentMatrix = "M";
      }
      j--;
    }
  }

  const alignedPdb = align1Arr.reverse().join("");
  const alignedUniprot = align2Arr.reverse().join("");
  const identity = alignedLength > 0 ? matches / alignedLength : 0;

  return {
    alignedPdb,
    alignedUniprot,
    score: maxScore,
    identity,
    pdbIndexToUniprotPosMap: pdbIndexToUniprot,
    uniprotPosToPdbResidueMap: uniprotToPdbResidue
  };
}

const SIFTS_TTL_MS = 60 * 60 * 1000;
const SIFTS_MAX_ENTRIES = 200;
const siftsEntryCache = new Map<string, { at: number; entry: any | null }>();

/**
 * PDBe's UniProt mapping for one entry (`/mappings/uniprot/<pdb>`), memoised for an hour.
 *
 * Resolving one entry asks for its chains and then each chain's mapping; without the memo that was
 * one network round trip per chain for the same document. A failed request is not memoised.
 */
async function fetchSiftsEntry(pdbId: string): Promise<any | null | undefined> {
  const key = pdbId.toLowerCase();
  const hit = siftsEntryCache.get(key);
  if (hit && Date.now() - hit.at < SIFTS_TTL_MS) return hit.entry;
  try {
    const res = await fetchWithRetry(`https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/${key}`, { timeout: 3000 });
    if (res.status === 404) {
      siftsEntryCache.set(key, { at: Date.now(), entry: null });
      return null;
    }
    if (!res.ok) return undefined;
    const data = (await res.json()) as any;
    const entry = data?.[key] ?? null;
    if (siftsEntryCache.size >= SIFTS_MAX_ENTRIES) {
      const oldest = siftsEntryCache.keys().next().value;
      if (oldest) siftsEntryCache.delete(oldest);
    }
    siftsEntryCache.set(key, { at: Date.now(), entry });
    return entry;
  } catch (err: any) {
    console.warn(`[SIFTS Warning] SIFTS query failed for ${pdbId}:`, err?.message);
    return undefined;
  }
}

/**
 * The chains of an entry that PDBe maps to this UniProt accession, with the UniProt range each
 * covers. `[]` when PDBe knows the entry and maps no chain to the accession (an ortholog's entry
 * is mapped to its own accession); null when the mapping could not be fetched.
 */
export async function querySiftsChains(
  pdbId: string,
  uniprotAccession: string
): Promise<Array<{ chainId: string; unpStart: number; unpEnd: number }> | null> {
  if (!pdbId || !/^[0-9][a-z0-9]{3}$/i.test(pdbId)) return null;
  const entry = await fetchSiftsEntry(pdbId);
  if (entry === undefined) return null;
  const mappings = entry?.UniProt?.[uniprotAccession]?.mappings;
  if (!Array.isArray(mappings)) return [];
  const byChain = new Map<string, { chainId: string; unpStart: number; unpEnd: number }>();
  for (const m of mappings) {
    const chainId = typeof m?.chain_id === "string" ? m.chain_id.trim().toUpperCase() : "";
    if (!chainId || typeof m.unp_start !== "number" || typeof m.unp_end !== "number") continue;
    const seen = byChain.get(chainId);
    byChain.set(chainId, seen
      ? { chainId, unpStart: Math.min(seen.unpStart, m.unp_start), unpEnd: Math.max(seen.unpEnd, m.unp_end) }
      : { chainId, unpStart: m.unp_start, unpEnd: m.unp_end });
  }
  return [...byChain.values()];
}

/**
 * Tier 1: Queries PDBe SIFTS API for authoritative residue-by-residue mappings.
 *
 * Only the requested accession's mapping is used. This used to fall back to the entry's FIRST
 * UniProt mapping when the accession was absent — for an ortholog's entry, or a complex's partner
 * chain, a mapping onto another protein's numbering, then accepted on a one-residue identity check.
 */
export async function querySiftsMapping(
  pdbId: string,
  chainId: string,
  uniprotAccession: string
): Promise<Map<number, { resSeq: number; insCode: string; resName: string }> | null> {
  if (!pdbId || !/^[0-9][a-z0-9]{3}$/i.test(pdbId) || pdbId.toUpperCase() === "1XYZ") {
    return null;
  }
  try {
    const pdbEntry = await fetchSiftsEntry(pdbId);
    if (!pdbEntry || !pdbEntry.UniProt) return null;

    const unpEntry = pdbEntry.UniProt[uniprotAccession] as any;
    if (!unpEntry || !Array.isArray(unpEntry.mappings)) return null;

    const targetChain = chainId.trim().toUpperCase();
    const mappingTable = new Map<number, { resSeq: number; insCode: string; resName: string }>();

    for (const m of unpEntry.mappings) {
      if (m.chain_id && m.chain_id.toUpperCase() === targetChain) {
        if (Array.isArray(m.unp_start) || typeof m.unp_start === "number") {
          // Check if per-residue mappings exist or segment mappings
          const startUnp = m.unp_start;
          const endUnp = m.unp_end;
          const startAuth = m.start?.author_residue_number ?? m.struct_start;
          const shift = startUnp - startAuth;

          // If individual residue mappings are present
          if (Array.isArray(m.residues)) {
            for (const r of m.residues) {
              if (r.unp_num && r.author_residue_number !== undefined) {
                mappingTable.set(r.unp_num, {
                  resSeq: r.author_residue_number,
                  insCode: r.author_insertion_code || "",
                  resName: r.chem_comp_id || ""
                });
              }
            }
          } else if (typeof startUnp === "number" && typeof endUnp === "number" && typeof startAuth === "number") {
            for (let u = startUnp; u <= endUnp; u++) {
              mappingTable.set(u, {
                resSeq: u - shift,
                insCode: "",
                resName: ""
              });
            }
          }
        }
      }
    }

    return mappingTable.size > 0 ? mappingTable : null;
  } catch (err: any) {
    console.warn(`[SIFTS Warning] SIFTS query failed for ${pdbId}:`, err.message);
    return null;
  }
}

export interface CoordinateResolutionResult {
  valid: boolean;
  source: "sifts" | "needleman_wunsch" | "alphafold_fallback";
  pdbText: string | null;
  mappedResSeq: number | null;
  /** Polymer residues with no UniProt position (tags, linkers, insertions), left out of `pdbText`. */
  unmappedResidues?: number;
  reason?: string;
}

/** The largest residue number the PDB format's four columns can hold. */
const MAX_PDB_RESSEQ = 9999;

/**
 * Per-atom records that copy an ATOM line's residue number and cannot be safely renumbered here.
 *
 * `ANISOU` carries anisotropic displacement, `SIGATM`/`SIGUIJ` the coordinate and B-factor sigmas.
 * They were previously copied through verbatim, so after a renumbering pass they still carried the
 * authors' numbers beside renumbered ATOM lines — and, because they were treated as metadata, the
 * records of chains whose ATOM lines were dropped survived too. No downstream reader (FoldX, the
 * viewer) takes them from this path, so they are dropped rather than given a second, contradictory
 * numbering.
 */
const PER_ATOM_RECORDS_DROPPED = new Set(["CONECT", "ANISOU", "SIGATM", "SIGUIJ"]);

const residueKey = (resSeq: number, insCode: string) => `${resSeq}|${insCode}`;

/**
 * 3-Tier Coordinate Alignment Resolution:
 * 1. Tier 1: PDBe SIFTS API
 * 2. Tier 2: Needleman-Wunsch sequence alignment (BLOSUM62)
 * 3. Strict Validation Gate: PDB_Residue(pos) === UniProt[pos - 1] === wt1Letter
 * 4. Tier 3: AlphaFold fallback if validation fails
 */
export async function resolvePdbCoordinatesDeterministically(params: {
  pdbId: string;
  chainId: string;
  rawPdbText: string;
  uniprotAccession: string;
  uniprotSequence: string;
  targetPos: number;
  expectedWt1: string;
}): Promise<CoordinateResolutionResult> {
  const {
    pdbId,
    chainId,
    rawPdbText,
    uniprotAccession,
    uniprotSequence,
    targetPos,
    expectedWt1
  } = params;

  const chainUpper = (chainId || "A").toUpperCase();
  const pdbExtraction = extractPdbChainSequence(rawPdbText, chainUpper);

  if (pdbExtraction.sequence.length === 0) {
    return {
      valid: false,
      source: "alphafold_fallback",
      pdbText: null,
      mappedResSeq: null,
      reason: `PDB ${pdbId} chain ${chainUpper} contains 0 ATOM residues.`
    };
  }

  // Tier 1: Try SIFTS API
  const siftsMap = await querySiftsMapping(pdbId, chainUpper, uniprotAccession);
  if (siftsMap && siftsMap.has(targetPos)) {
    const mapped = siftsMap.get(targetPos)!;
    // Find matching residue in extraction
    const targetRes = pdbExtraction.residues.find(
      r => r.resSeq === mapped.resSeq && (!mapped.insCode || r.insCode === mapped.insCode)
    );

    if (targetRes && targetRes.resName1.toUpperCase() === expectedWt1.toUpperCase()) {
      // Valid SIFTS mapping verified. Every residue takes its own UniProt number from the map, so a
      // mapping with several segments is numbered right on each of them, not only on the site's.
      const toUniprot = new Map<string, number>();
      for (const [unpPos, r] of siftsMap) toUniprot.set(residueKey(r.resSeq, r.insCode), unpPos);
      const renumbered = renumberChainToUniprot(rawPdbText, chainUpper, toUniprot);
      if (renumbered) {
        return {
          valid: true,
          source: "sifts",
          pdbText: renumbered.pdbText,
          mappedResSeq: targetPos,
          unmappedResidues: renumbered.unmappedResidues
        };
      }
    }
  }

  // Tier 2: Needleman-Wunsch Alignment Fallback
  const alignment = alignNeedlemanWunsch(pdbExtraction, uniprotSequence);
  const matchedPdbRes = alignment.uniprotPosToPdbResidueMap.get(targetPos);

  // Compute identity over the PDB domain length (handling partial structures)
  let pdbDomainMatches = 0;
  for (let idx = 0; idx < pdbExtraction.residues.length; idx++) {
    const unpPos = alignment.pdbIndexToUniprotPosMap.get(idx);
    if (unpPos !== undefined && unpPos >= 1 && unpPos <= uniprotSequence.length) {
      if (pdbExtraction.residues[idx].resName1.toUpperCase() === uniprotSequence[unpPos - 1].toUpperCase()) {
        pdbDomainMatches++;
      }
    }
  }
  const domainIdentity = pdbExtraction.residues.length > 0 ? pdbDomainMatches / pdbExtraction.residues.length : 0;

  if (
    matchedPdbRes &&
    matchedPdbRes.resName1.toUpperCase() === expectedWt1.toUpperCase() &&
    domainIdentity >= 0.85
  ) {
    // Valid Needleman-Wunsch alignment verified. Each aligned residue takes its own UniProt number.
    const toUniprot = new Map<string, number>();
    alignment.pdbIndexToUniprotPosMap.forEach((unpPos, idx) => {
      const r = pdbExtraction.residues[idx];
      if (r) toUniprot.set(residueKey(r.resSeq, r.insCode), unpPos);
    });
    const renumbered = renumberChainToUniprot(rawPdbText, chainUpper, toUniprot);
    if (renumbered) {
      return {
        valid: true,
        source: "needleman_wunsch",
        pdbText: renumbered.pdbText,
        mappedResSeq: targetPos,
        unmappedResidues: renumbered.unmappedResidues
      };
    }
  }

  // Tier 3: Validation Failed -> Reject and signal AlphaFold fallback
  const actualPdbRes = matchedPdbRes ? `${matchedPdbRes.resName1}${matchedPdbRes.resSeq}` : "missing in ATOM records";
  return {
    valid: false,
    source: "alphafold_fallback",
    pdbText: null,
    mappedResSeq: null,
    reason: `Residue at position ${targetPos} failed sequence validation in PDB ${pdbId} (expected ${expectedWt1}, found ${actualPdbRes}, alignment identity: ${(alignment.identity * 100).toFixed(1)}%).`
  };
}

/** `line` with residue number `resSeq` and no insertion code (columns 23–27). */
function withResidueNumber(line: string, resSeq: number): string {
  const padded = line.length < 27 ? line.padEnd(27) : line;
  return padded.substring(0, 22) + String(resSeq).padStart(4, " ") + " " + padded.substring(27);
}

/**
 * Rewrites one chain into UniProt numbering, residue by residue, and drops every other chain.
 *
 * It replaced a single shift taken at the variant's position, which numbered a chain correctly only
 * on the site's own segment: past an insertion, a deletion or an engineered linker, every residue
 * carried a neighbour's UniProt number, and contacts, pockets and highlights there landed on the
 * wrong residues. A tag's residues also took UniProt numbers they do not have.
 *
 * - A polymer residue in `toUniprot` (keyed `resSeq|insCode`) takes its UniProt number.
 * - A polymer residue with no UniProt position (tag, linker, insertion) is left out, as a residue
 *   missing from the density would be; the count is returned. It is never given an invented number,
 *   and insertion codes are avoided because FoldX reads templates through this path.
 * - Waters are left out. A ligand or ion keeps its own number unless a mapped residue now carries
 *   it, in which case it moves to the first free number from 9000.
 *
 * Null when a UniProt number does not fit the PDB format's four columns.
 */
export function renumberChainToUniprot(
  pdbText: string,
  chainId: string,
  toUniprot: Map<string, number>
): { pdbText: string; unmappedResidues: number } | null {
  const chain = chainId.trim().toUpperCase();
  for (const unpPos of toUniprot.values()) {
    if (unpPos > MAX_PDB_RESSEQ) return null;
  }
  const lines = pdbText.split("\n");
  const inChain = (line: string) => (line.length > 21 ? line.charAt(21).toUpperCase() : "") === chain;
  const keyOf = (line: string) =>
    residueKey(parseInt(line.substring(22, 26).trim(), 10), line.length > 26 ? line.charAt(26).trim() : "");

  const mappedNumbers = new Set<number>(toUniprot.values());
  const isLigand = (line: string, resName: string) =>
    line.startsWith("HETATM") && !WATER_RESIDUES.has(resName) && !MODIFIED_RESIDUE_PARENT[resName] && !toUniprot.has(keyOf(line));
  // Numbers taken once the chain is renumbered: the mapped residues, and the ligands that keep theirs.
  const taken = new Set<number>(mappedNumbers);
  for (const line of lines) {
    if (!line.startsWith("HETATM") || !inChain(line)) continue;
    const resSeq = parseInt(line.substring(22, 26).trim(), 10);
    if (!Number.isNaN(resSeq) && isLigand(line, line.substring(17, 20).trim().toUpperCase())) taken.add(resSeq);
  }

  const unmapped = new Set<string>();
  const movedLigands = new Map<string, number>();
  let nextLigandNumber = 9000;
  const out: string[] = [];
  for (const line of lines) {
    const isAtom = line.startsWith("ATOM");
    const isHet = line.startsWith("HETATM");
    const isTer = line.startsWith("TER");
    if (PER_ATOM_RECORDS_DROPPED.has(line.substring(0, 6).trim())) continue;
    if (!isAtom && !isHet && !isTer) {
      out.push(line);
      continue;
    }
    if (!inChain(line)) continue;
    const resSeq = parseInt(line.substring(22, 26).trim(), 10);
    if (Number.isNaN(resSeq)) continue;
    const key = keyOf(line);
    const unpPos = toUniprot.get(key);
    if (unpPos !== undefined) {
      out.push(withResidueNumber(line, unpPos));
      continue;
    }
    if (isTer) continue;
    const resName = line.substring(17, 20).trim().toUpperCase();
    if (isAtom || MODIFIED_RESIDUE_PARENT[resName]) {
      unmapped.add(key);
      continue;
    }
    if (WATER_RESIDUES.has(resName)) continue;
    if (!mappedNumbers.has(resSeq)) {
      out.push(line);
      continue;
    }
    let moved = movedLigands.get(key);
    if (moved === undefined) {
      while (taken.has(nextLigandNumber)) nextLigandNumber++;
      if (nextLigandNumber > MAX_PDB_RESSEQ) continue;
      moved = nextLigandNumber;
      taken.add(moved);
      movedLigands.set(key, moved);
    }
    out.push(withResidueNumber(line, moved));
  }

  return { pdbText: out.join("\n"), unmappedResidues: unmapped.size };
}
