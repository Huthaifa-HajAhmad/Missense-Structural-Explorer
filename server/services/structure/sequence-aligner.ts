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
 * Extracts unique amino acid residues and 1-letter sequence from PDB ATOM lines for a target chain.
 */
export function extractPdbChainSequence(pdbText: string, chainId: string): PdbChainExtraction {
  const lines = pdbText.split("\n");
  const targetChain = chainId.trim().toUpperCase();
  const residues: PdbResidueItem[] = [];
  let lastKey = "";

  for (const line of lines) {
    if (line.startsWith("ATOM")) {
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
          const resName1 = AMINO_ACID_3_TO_1[formatted3] || (resName3.length === 1 ? resName3 : "X");
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

/**
 * Tier 1: Queries PDBe SIFTS API for authoritative residue-by-residue mappings.
 */
export async function querySiftsMapping(
  pdbId: string,
  chainId: string,
  uniprotAccession: string
): Promise<Map<number, { resSeq: number; insCode: string; resName: string }> | null> {
  if (!pdbId || !/^[0-9][a-z0-9]{3}$/i.test(pdbId) || pdbId.toUpperCase() === "1XYZ") {
    return null;
  }
  const url = `https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/${pdbId.toLowerCase()}`;
  try {
    const res = await fetchWithRetry(url, { timeout: 3000 });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const pdbEntry = data[pdbId.toLowerCase()];
    if (!pdbEntry || !pdbEntry.UniProt) return null;

    const unpEntry = pdbEntry.UniProt[uniprotAccession] || Object.values(pdbEntry.UniProt)[0] as any;
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
  reason?: string;
}

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
      // Valid SIFTS mapping verified!
      const shift = targetPos - mapped.resSeq;
      const shiftedPdb = rewritePdbCoordinates(rawPdbText, chainUpper, (seq) => seq + shift);
      return {
        valid: true,
        source: "sifts",
        pdbText: shiftedPdb,
        mappedResSeq: targetPos
      };
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
    // Valid Needleman-Wunsch alignment verified!
    const shift = targetPos - matchedPdbRes.resSeq;
    const shiftedPdb = rewritePdbCoordinates(rawPdbText, chainUpper, (seq) => seq + shift);
    return {
      valid: true,
      source: "needleman_wunsch",
      pdbText: shiftedPdb,
      mappedResSeq: targetPos
    };
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

/**
 * Rewires ATOM and TER record residue sequence numbers in a PDB file.
 */
export function rewritePdbCoordinates(
  pdbText: string,
  targetChain: string,
  seqMapper: (resSeq: number) => number
): string {
  const lines = pdbText.split("\n");
  const filteredLines: string[] = [];
  const chain = targetChain.trim().toUpperCase();

  for (const line of lines) {
    if (line.startsWith("ATOM") || line.startsWith("HETATM") || line.startsWith("TER")) {
      const lineChain = line.length > 21 ? line.charAt(21).toUpperCase() : "";
      if (lineChain === chain && line.length >= 26) {
        const resSeq = parseInt(line.substring(22, 26).trim(), 10);
        if (!isNaN(resSeq)) {
          const newResSeq = seqMapper(resSeq);
          const newResSeqStr = String(newResSeq).padStart(4, " ");
          filteredLines.push(line.substring(0, 22) + newResSeqStr + line.substring(26));
          continue;
        }
      }
      if (lineChain === chain) {
        filteredLines.push(line);
      }
    } else if (!line.startsWith("CONECT")) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join("\n");
}
