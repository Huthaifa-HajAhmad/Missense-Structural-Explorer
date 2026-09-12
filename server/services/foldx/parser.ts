export interface FoldxParsedResult {
  ddG: number | null;
  sd: number;
  vdw: number;
  electrostatics: number;
  rawDdGs: number[];
  stericClashWarning: boolean;
  isDegenerate?: boolean;
}

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

  let validRuns = [...calculatedRuns];
  if (calculatedRuns.length >= 4) {
    const rawDdGs = calculatedRuns.map(r => r.ddG);
    const sorted = [...rawDdGs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const absoluteDeviations = sorted.map(val => Math.abs(val - median)).sort((a, b) => a - b);
    const mad = absoluteDeviations[Math.floor(absoluteDeviations.length / 2)] || 0.0001;
    // Modified Z-score (Iglewicz & Hoaglin 1993): 0.6745 * |x - median| / MAD <= 3.5
    const filtered = calculatedRuns.filter(r => {
      const modZ = (0.6745 * Math.abs(r.ddG - median)) / mad;
      return modZ <= 3.5;
    });
    if (filtered.length >= 3) {
      validRuns = filtered;
    }
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
  // If all 5 runs produced identical values, the FoldX stochastic simulation failed to explore conformation space correctly.
  const isExtreme = Math.abs(meanDdG) > 20.0;
  const isIdentical = validDdGs.length > 1 && sd < 0.001;
  const isDegenerate = isExtreme || isIdentical;
  if (isExtreme) {
    console.warn(`[FoldX Warning] Extreme unphysical energy artifact detected (mean ΔΔG = ${meanDdG.toFixed(2)} kcal/mol > 20 kcal/mol). Excluding from consensus.`);
  }
  if (isIdentical) {
    console.warn(`[FoldX Warning] Degenerate runs detected (SD = ${sd.toFixed(5)} < 0.001). All FoldX BuildModel runs returned identical values, indicating failed minimization.`);
  }
  const finalDdG = isExtreme ? null : parseFloat(meanDdG.toFixed(4));

  return {
    ddG: finalDdG,
    sd: parseFloat(sd.toFixed(4)),
    vdw: parseFloat(meanVdw.toFixed(4)),
    electrostatics: parseFloat(meanElec.toFixed(4)),
    rawDdGs: validDdGs,
    stericClashWarning,
    isDegenerate
  };
}
