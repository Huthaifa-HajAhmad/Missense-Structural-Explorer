import { type DetectedPocket } from "./types.ts";

/** Column positions in a P2Rank predictions CSV, resolved from its header; -1 means the column is absent. */
function resolveP2RankColumns(header: string) {
  const headerCols = header.split(",").map(c => c.trim().toLowerCase());
  const findCol = (...names: string[]) => headerCols.findIndex(h => names.includes(h));
  const residueCol = headerCols.findIndex(h => h === "residue_ids" || h === "residues" || h.includes("residue"));
  return {
    volume: findCol("volume", "sas_volume", "volume_sas"),
    sas: headerCols.findIndex(h => h === "sas_points" || h === "saspoints" || h.includes("sas")),
    surfAtoms: headerCols.findIndex(h => h === "surf_atoms" || h === "surfatoms" || h.includes("surf_atom")),
    residues: residueCol !== -1 ? residueCol : 9,
    score: findCol("score"),
    probability: findCol("probability"),
    rank: findCol("rank"),
    centreX: findCol("center_x", "centerx"),
    centreY: findCol("center_y", "centery"),
    centreZ: findCol("center_z", "centerz")
  };
}

type P2RankColumns = ReturnType<typeof resolveP2RankColumns>;

/** One predictions row as a pocket; `ordinal` stands in for the id when the rank column is missing. */
function parseP2RankRow(cols: string[], ordinal: number, c: P2RankColumns): DetectedPocket {
  const col = (idx: number) => (idx !== -1 && idx < cols.length ? cols[idx] : undefined);
  const rawRank = col(c.rank);
  const id = rawRank !== undefined && !isNaN(parseInt(rawRank, 10)) ? parseInt(rawRank, 10) : ordinal;
  const score = parseFloat((col(c.score) ?? cols[2]) ?? "");
  const probability = parseFloat((col(c.probability) ?? cols[3]) ?? "");
  const parsedSas = c.sas !== -1 && cols.length > c.sas ? parseInt(cols[c.sas], 10) : parseInt(cols[4], 10);
  const sasPoints = !isNaN(parsedSas) ? parsedSas : undefined;
  const parsedSurfAtoms = c.surfAtoms !== -1 && cols.length > c.surfAtoms ? parseInt(cols[c.surfAtoms], 10) : (cols.length > 5 ? parseInt(cols[5], 10) : undefined);
  const surfaceAtoms = parsedSurfAtoms !== undefined && !isNaN(parsedSurfAtoms) ? parsedSurfAtoms : undefined;
  const residueKeys = ((cols.length > c.residues ? cols[c.residues] : "") || "").split(/\s+/).filter(Boolean);
  const residueIndices = residueKeys.map(x => {
    const parts = x.split("_");
    return parseInt(parts[parts.length - 1], 10);
  }).filter(x => !isNaN(x));

  // P2Rank's own cavity centre. Previously ignored, which forced the
  // distance to be measured to the centroid of the pocket's residues
  // instead — a quantity that grows with pocket size.
  const parsedCentre = [col(c.centreX), col(c.centreY), col(c.centreZ)].map(v => (v === undefined ? NaN : parseFloat(v)));
  const cavityCentre = parsedCentre.every(v => Number.isFinite(v))
    ? { x: parsedCentre[0], y: parsedCentre[1], z: parsedCentre[2] }
    : undefined;

  const volume = c.volume !== -1 && cols.length > c.volume ? parseFloat(cols[c.volume]) : NaN;
  return { id, score, probability, sasPoints, surfaceAtoms, residueKeys, residueIndices, volume, cavityCentre };
}

/**
 * Parse P2Rank's `*_predictions.csv` into pockets.
 *
 * The real `*_predictions.csv` header, taken from the bundled
 * p2rank_2.6-alpha jar and cross-checked against its README, is:
 *
 *   name, rank, score, probability, sas_points, surf_atoms,
 *   center_x, center_y, center_z, residue_ids, surf_atom_ids
 *
 * There is NO `volume` column — per-pocket volume is only emitted by the
 * separately-flagged `-export_pocket_descriptors` export, which is read
 * from its own file by `readPocketDescriptorVolume`. Note also that column 0 is `name` ("pocket1"),
 * so the previous `parseInt(cols[0], 10)` was always NaN; ids are taken
 * from `rank` and fall back to the row ordinal.
 *
 * Column indices are resolved from the header rather than hard-coded, so a
 * future P2Rank version that reorders or adds a column cannot silently
 * shift `score`/`probability` onto the wrong field.
 */
export function parseP2RankPredictions(csvText: string): DetectedPocket[] {
  const csvLines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (csvLines.length <= 1) return [];
  const columns = resolveP2RankColumns(csvLines[0]);
  const pockets: DetectedPocket[] = [];
  for (let i = 1; i < csvLines.length; i++) {
    const cols = csvLines[i].split(",").map(c => c.trim());
    if (cols.length >= 7) pockets.push(parseP2RankRow(cols, i, columns));
  }
  return pockets;
}
