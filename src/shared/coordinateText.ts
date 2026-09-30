/**
 * coordinateText.ts — the few facts the 3D view reads straight out of a PDB text.
 *
 * Pure and dependency-free (`src/shared` may not import from outside itself), so the viewer, the
 * inspector and their tests read one implementation.
 *
 * WHAT THIS MODULE WILL NOT DO
 * ---------------------------
 * It never decides what the B-factor column MEANS from the numbers in it. The viewer used to: a
 * maximum B between 50 and 100 was taken to be AlphaFold pLDDT, and any "AF-" substring anywhere in
 * the file flagged an AlphaFold model. Crystal structures routinely carry temperature factors of
 * 50–100 Å², so a 2.6 Å entry was coloured and filtered as if its most mobile atoms were its most
 * confident ones. The meaning comes from provenance (which endpoint or engine produced the file);
 * this module only measures. The one exception is `plddtScale`, which reads the SCALE of a column
 * already known to hold pLDDT (the ESM Atlas writes 0–1, AlphaFold DB 0–100).
 */

export interface BFactorScan {
  /** Cα atoms read. */
  count: number;
  min: number | null;
  max: number | null;
  /** Quartile cuts of the Cα B-factors (25th, 50th, 75th percentile), or null when fewer than 4 atoms. */
  quartiles: [number, number, number] | null;
}

function isAtomLine(line: string): boolean {
  return line.startsWith("ATOM  ") || line.startsWith("HETATM");
}

function atomName(line: string): string {
  return line.slice(12, 16).trim();
}

function resSeq(line: string): number {
  return Number.parseInt(line.slice(22, 26).trim(), 10);
}

function bFactor(line: string): number {
  return Number.parseFloat(line.slice(60, 66).trim());
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Cα B-factor distribution of the FIRST model in a PDB text. mmCIF is not scanned (returns count 0). */
export function scanBFactors(pdbText: string | null | undefined): BFactorScan {
  const empty: BFactorScan = { count: 0, min: null, max: null, quartiles: null };
  if (!pdbText) return empty;
  const values: number[] = [];
  const lines = pdbText.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("ENDMDL")) break;
    if (!line.startsWith("ATOM  ") || line.length < 66 || atomName(line) !== "CA") continue;
    const b = bFactor(line);
    if (Number.isFinite(b)) values.push(b);
  }
  if (values.length === 0) return empty;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    quartiles: sorted.length >= 4 ? [quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75)] : null,
  };
}

/**
 * The scale of a column already known to hold pLDDT.
 *
 * The ESM Atlas fold endpoint writes pLDDT as 0–1; AlphaFold DB and ESMFold2 write 0–100. Read with
 * the 50/70/90 bands, every Atlas model came out "very low" and the ≥ 70 filter removed all of it.
 */
export function plddtScale(scan: BFactorScan): 1 | 100 | null {
  if (scan.count === 0 || scan.max === null) return null;
  return scan.max <= 1.0 ? 1 : 100;
}

export interface ResidueAt {
  resName: string;
  chain: string;
  /** Cα B-factor of that residue, or null if the Cα is absent. */
  caBFactor: number | null;
}

/**
 * The residue a PDB text carries at an author residue number (first model, first chain that has it,
 * or `chain` when given). Used to check that the highlighted residue is the variant's residue: an
 * entry numbered differently from UniProt highlights some other amino acid at "position 116".
 */
export function readResidueAt(
  pdbText: string | null | undefined,
  position: number | null | undefined,
  chain?: string | null
): ResidueAt | null {
  if (!pdbText || position === null || position === undefined || !Number.isFinite(position)) return null;
  const wantChain = chain ? chain.toUpperCase() : null;
  let found: ResidueAt | null = null;
  for (const line of pdbText.split(/\r?\n/)) {
    if (line.startsWith("ENDMDL")) break;
    if (!isAtomLine(line) || line.length < 27) continue;
    if (resSeq(line) !== position) continue;
    const lineChain = line.slice(21, 22).trim().toUpperCase();
    if (wantChain && lineChain !== wantChain) continue;
    if (found && lineChain !== found.chain) break;
    if (!found) found = { resName: line.slice(17, 20).trim().toUpperCase(), chain: lineChain, caBFactor: null };
    if (atomName(line) === "CA" && line.length >= 66) {
      const b = bFactor(line);
      found.caBFactor = Number.isFinite(b) ? b : null;
      break;
    }
  }
  return found;
}

/**
 * Positive identification of an AlphaFold DB file from its own header records, or `null`.
 *
 * Only TITLE / HEADER / REMARK / COMPND lines are read, never atom records: the old `"AF-"` test
 * matched any file whose text contained those three characters. `null` means "not identified",
 * never "not AlphaFold".
 */
/**
 * Whether two structures are a wild-type/variant pair at `position`: the same chain, the same
 * residues in the same order, differing only at that position. It catches a paired wild type
 * left over from another variant's run before it is measured against this one.
 */
export function isSitePair(
  wildTypeText: string | null | undefined,
  variantText: string | null | undefined,
  position: number,
  chain?: string | null
): boolean {
  const residues = (text: string | null | undefined) => {
    const out: string[] = [];
    if (!text) return out;
    const wantChain = chain ? chain.toUpperCase() : null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("ENDMDL")) break;
      // ATOM only: a calcium ion is a HETATM named "CA" too.
      if (!line.startsWith("ATOM  ") || atomName(line) !== "CA") continue;
      const lineChain = line.slice(21, 22).trim().toUpperCase();
      if (wantChain && lineChain !== wantChain) continue;
      out.push(`${lineChain}:${resSeq(line)}:${line.slice(17, 20).trim().toUpperCase()}`);
    }
    return out;
  };
  const wt = residues(wildTypeText);
  const mt = residues(variantText);
  if (wt.length === 0 || wt.length !== mt.length) return false;
  let siteSeen = false;
  for (let i = 0; i < wt.length; i++) {
    const [wChain, wSeq, wName] = wt[i].split(":");
    const [mChain, mSeq, mName] = mt[i].split(":");
    if (wChain !== mChain || wSeq !== mSeq) return false;
    if (Number(wSeq) === position) {
      siteSeen = true;
      continue;
    }
    if (wName !== mName) return false;
  }
  return siteSeen;
}

export function identifyAlphaFoldHeader(pdbText: string | null | undefined): { version: string | null } | null {
  if (!pdbText) return null;
  const head = pdbText.slice(0, 8000).split(/\r?\n/);
  for (const line of head) {
    if (line.startsWith("ATOM  ")) break;
    if (!/^(TITLE |HEADER|REMARK|COMPND)/.test(line)) continue;
    if (/ALPHAFOLD/i.test(line)) {
      const version = /\bV(\d+(?:\.\d+)?)\b/i.exec(line);
      return { version: version ? `v${version[1]}` : null };
    }
  }
  return null;
}
