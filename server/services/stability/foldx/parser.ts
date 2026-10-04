export interface FoldxParsedResult {
  ddG: number | null;
  sd: number;
  vdw: number;
  electrostatics: number;
  /** Every BuildModel run that entered the mean and SD. */
  rawDdGs: number[];
  /** Runs left out because they were physically impossible; empty in the normal case. */
  excludedDdGs: number[];
  stericClashWarning: boolean;
  isDegenerate?: boolean;
}

/** A ΔΔG beyond this is an energy-function artefact, not a measurement (H-5). */
const EXTREME_DDG_KCAL = 20.0;

export function parseFoldxDifFile(fxText: string): FoldxParsedResult {
  const fxLines = fxText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (fxLines.length === 0) {
    throw new Error("Invalid FoldX file: empty file.");
  }
  
  // Find header line (first line that contains 'total energy'/'total' and starts with 'pdb')
  const headerLineIdx = fxLines.findIndex(line => {
    const lower = line.toLowerCase();
    return (lower.startsWith("pdb\t") || lower.startsWith("pdb ") || lower.includes("pdb\t")) &&
           (lower.includes("total energy") || lower.includes("total") || lower.includes("total_energy"));
  });
  if (headerLineIdx === -1) {
    throw new Error("Invalid FoldX file: no header line found.");
  }
  
  const header = fxLines[headerLineIdx];
  const headers = header.split('\t').map(h => h.toLowerCase().trim());
  
  // Strict column matching (BIO-5)
  let totalIdx = headers.findIndex(h => h === "total energy" || h === "total" || h === "total_energy");
  if (totalIdx === -1) {
    totalIdx = headers.findIndex(h => h.includes("total energy") || h === "total");
  }
  if (totalIdx === -1) {
    throw new Error("Invalid FoldX file: 'total energy' column not found in headers.");
  }

  const vdwIdx = headers.findIndex(h => h.includes("van der waals") || h.includes("vdw") || h.includes("clash"));
  const elecIdx = headers.findIndex(h => h.includes("electrostatics") || h.includes("electrostatic") || h.includes("elec"));

  let wtTotal: number | null = null;
  let wtVdw: number | null = null;
  let wtElec: number | null = null;

  interface RawRunData {
    name: string;
    total: number;
    vdw: number;
    elec: number;
  }
  const mutantRuns: RawRunData[] = [];

  for (let i = headerLineIdx + 1; i < fxLines.length; i++) {
    const line = fxLines[i];
    if (line.startsWith("#")) continue;
    const parts = line.split('\t').map(p => p.trim());
    if (parts.length === 0 || parts[0] === "") continue;
    const filename = parts[0].toLowerCase().trim();
    
    const totalVal = parts.length > totalIdx ? parseFloat(parts[totalIdx]) : NaN;
    const vdwVal = vdwIdx !== -1 && parts.length > vdwIdx ? parseFloat(parts[vdwIdx]) : 0;
    const elecVal = elecIdx !== -1 && parts.length > elecIdx ? parseFloat(parts[elecIdx]) : 0;

    if (isNaN(totalVal)) continue;

    if (filename === "wt.pdb" || filename.endsWith("/wt.pdb") || filename.endsWith("\\wt.pdb") || filename === "wt") {
      wtTotal = totalVal;
      wtVdw = vdwVal;
      wtElec = elecVal;
    } else {
      mutantRuns.push({
        name: filename,
        total: totalVal,
        vdw: vdwVal,
        elec: elecVal
      });
    }
  }

  if (mutantRuns.length === 0) {
    throw new Error("Invalid FoldX file: no mutant rows found.");
  }

  interface CalculatedRun {
    ddG: number;
    vdw: number;
    elec: number;
  }
  const calculatedRuns: CalculatedRun[] = [];

  for (const run of mutantRuns) {
    let runDdG = run.total;
    let runVdw = run.vdw;
    let runElec = run.elec;

    if (wtTotal !== null && !isNaN(wtTotal)) {
      runDdG = run.total - wtTotal;
      runVdw = run.vdw - (wtVdw ?? 0);
      runElec = run.elec - (wtElec ?? 0);
    }
    calculatedRuns.push({ ddG: runDdG, vdw: runVdw, elec: runElec });
  }

  /**
   * Only a run that is physically impossible is excluded — never a run that merely disagrees.
   *
   * This used to be a MAD outlier filter (modified Z > 3.5). With five runs it is the wrong tool:
   * BuildModel's runs are not noisy draws around one value, they land in discrete side-chain
   * rotamer states, and a 3-versus-2 split is a legitimate bimodal distribution. Measured on SOD1
   * p.Ala5Val (repaired AlphaFold template), the runs were 1.55, 1.58, 1.61, 2.90, 2.95; the
   * three tight ones set a MAD of 0.06, the other two scored a modified Z of ~14 and were
   * discarded, and the result was reported as 1.58 ± 0.03. The honest summary is 2.12 ± 0.74.
   * Across 26 SOD1 variant runs the filter fired on 8 and understated the reported SD every time.
   *
   * What stays excluded is the per-run version of the >20 kcal/mol artefact bound used below.
   */
  const physicalRuns = calculatedRuns.filter(r => Number.isFinite(r.ddG) && Math.abs(r.ddG) <= EXTREME_DDG_KCAL);
  // If every run is unphysical keep them all, so the mean-level artefact check below still fires.
  const validRuns = physicalRuns.length > 0 ? physicalRuns : calculatedRuns;
  const excludedDdGs = physicalRuns.length > 0 ? calculatedRuns.filter(r => !physicalRuns.includes(r)).map(r => r.ddG) : [];
  if (excludedDdGs.length > 0) {
    console.warn(`[FoldX Warning] Excluded ${excludedDdGs.length} of ${calculatedRuns.length} BuildModel runs as unphysical (|ΔΔG| > ${EXTREME_DDG_KCAL} kcal/mol): ${excludedDdGs.map(v => v.toFixed(1)).join(", ")}.`);
  }

  const validDdGs = validRuns.map(r => r.ddG);
  const sumDdG = validDdGs.reduce((a, b) => a + b, 0);
  const meanDdG = sumDdG / validDdGs.length;

  let sd = 0;
  if (validDdGs.length > 1) {
    const squareDiffs = validDdGs.map(val => Math.pow(val - meanDdG, 2));
    const sumSquareDiffs = squareDiffs.reduce((a, b) => a + b, 0);
    sd = Math.sqrt(sumSquareDiffs / (validDdGs.length - 1));
  }

  const validVdws = validRuns.map(r => r.vdw);
  const validElecs = validRuns.map(r => r.elec);
  const meanVdw = validVdws.reduce((a, b) => a + b, 0) / validVdws.length;
  const meanElec = validElecs.reduce((a, b) => a + b, 0) / validElecs.length;

  const stericClashWarning = meanVdw > 2.0;

  // H-5 Fix: Detect extreme unphysical energy artifacts (> 20 kcal/mol) or degenerate runs (SD < 0.001)
  // `isDegenerate` still flags identical runs for callers that want to know, but identical runs alone
  // are not an error (see the log below); only the extreme mean nulls the ΔΔG.
  const isExtreme = Math.abs(meanDdG) > EXTREME_DDG_KCAL;
  const isIdentical = validDdGs.length > 1 && sd < 0.001;
  const isDegenerate = isExtreme || isIdentical;
  if (isExtreme) {
    console.warn(`[FoldX Warning] Extreme unphysical energy artifact detected (mean ΔΔG = ${meanDdG.toFixed(2)} kcal/mol > 20 kcal/mol). Excluding from consensus.`);
  }
  if (isIdentical) {
    // Not a failure: with a fixed rotabase seed, identical runs are expected when the substitution has
    // one dominant rotamer (seen on 4 of 26 SOD1 variant runs). The UI explains it the same way.
    console.info(`[FoldX] All ${validDdGs.length} BuildModel runs returned the same ΔΔG (SD ${sd.toFixed(5)}): no run-to-run spread to report.`);
  }
  const finalDdG = isExtreme ? null : parseFloat(meanDdG.toFixed(4));

  return {
    ddG: finalDdG,
    sd: parseFloat(sd.toFixed(4)),
    vdw: parseFloat(meanVdw.toFixed(4)),
    electrostatics: parseFloat(meanElec.toFixed(4)),
    rawDdGs: validDdGs,
    excludedDdGs,
    stericClashWarning,
    isDegenerate
  };
}
