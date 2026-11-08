import { readCaTrace } from "./coordinateText";
import { getKabschTransform } from "./geometry3";

/**
 * An experimental template (the one FoldX builds the variant on) often covers a short stretch of the
 * protein. The variant and superposition views then draw that stretch alone. The full-length
 * AlphaFold model can be drawn faintly around it as context, but only when it is moved into the
 * template's frame by a fit on the residues both files have.
 */

/** Fewer shared Cα atoms than this cannot fix a rotation worth trusting. */
export const MIN_CONTEXT_FIT_RESIDUES = 10;
/** Share of shared residue numbers whose residue names must agree; below it the two files number differently. */
const MIN_NAME_AGREEMENT = 0.9;
/** A fit looser than this is not the same fold, so the context is not drawn. */
export const MAX_CONTEXT_FIT_RMSD = 4;

export interface ContextFit {
  /** The context coordinates in the template's frame. Atom lines only; the B column is kept as it was. */
  pdb: string;
  /** Cα atoms the fit used. */
  matched: number;
  /** Root-mean-square distance of those atoms after the fit, in Å. */
  rmsd: number;
  /** The residue numbers the template covers: they are left out of the context so the ribbons do not overlap. */
  covered: { start: number; end: number };
  /** Residues in the context model. */
  contextResidues: number;
}

function formatCoordinate(value: number): string {
  return value.toFixed(3).padStart(8);
}

/**
 * Moves `contextPdb` onto `templatePdb` by a least-squares (Kabsch) fit of the Cα atoms whose residue
 * numbers and names agree. Returns null when the two files do not line up, so a wrong fit is never drawn,
 * and when the template already covers (nearly) the whole model, so there is no context to add.
 */
export function fitContextOntoTemplate(contextPdb: string, templatePdb: string): ContextFit | null {
  const context = readCaTrace(contextPdb);
  const template = readCaTrace(templatePdb);
  const contextIndex = new Map(context.residues.map((residue, i) => [residue, i]));

  const pairs: Array<[number, number]> = [];
  let agreeing = 0;
  template.residues.forEach((residue, t) => {
    const c = contextIndex.get(residue);
    if (c === undefined) return;
    pairs.push([c, t]);
    if (context.resNames[c] === template.resNames[t]) agreeing += 1;
  });
  if (pairs.length < MIN_CONTEXT_FIT_RESIDUES || agreeing / pairs.length < MIN_NAME_AGREEMENT) return null;

  const point = (coords: Float64Array, i: number) => ({ x: coords[3 * i], y: coords[3 * i + 1], z: coords[3 * i + 2] });
  const moving = pairs.map(([c]) => point(context.coords, c));
  const fixed = pairs.map(([, t]) => point(template.coords, t));
  const { R, centroidRef, centroidTarget } = getKabschTransform(moving, fixed);
  const move = (p: { x: number; y: number; z: number }) => {
    const x = p.x - centroidRef.x;
    const y = p.y - centroidRef.y;
    const z = p.z - centroidRef.z;
    return {
      x: R[0][0] * x + R[0][1] * y + R[0][2] * z + centroidTarget.x,
      y: R[1][0] * x + R[1][1] * y + R[1][2] * z + centroidTarget.y,
      z: R[2][0] * x + R[2][1] * y + R[2][2] * z + centroidTarget.z,
    };
  };

  const squared = moving.reduce((sum, p, i) => {
    const m = move(p);
    return sum + (m.x - fixed[i].x) ** 2 + (m.y - fixed[i].y) ** 2 + (m.z - fixed[i].z) ** 2;
  }, 0);
  const rmsd = Math.sqrt(squared / pairs.length);
  if (rmsd > MAX_CONTEXT_FIT_RMSD) return null;

  // A template that spans the whole model (FoldX ran on the AlphaFold model itself) leaves nothing to draw around it.
  const covered = { start: template.residues[0], end: template.residues[template.residues.length - 1] };
  const outside = context.residues.filter(residue => residue < covered.start || residue > covered.end).length;
  if (outside < MIN_CONTEXT_FIT_RESIDUES) return null;

  const atoms = contextPdb.split(/\r?\n/).filter(line => line.startsWith("ATOM  ") && line.length >= 54).map(line => {
    const m = move({ x: Number.parseFloat(line.slice(30, 38)), y: Number.parseFloat(line.slice(38, 46)), z: Number.parseFloat(line.slice(46, 54)) });
    return `${line.slice(0, 30)}${formatCoordinate(m.x)}${formatCoordinate(m.y)}${formatCoordinate(m.z)}${line.slice(54)}`;
  });
  return {
    pdb: `${atoms.join("\n")}\nEND\n`,
    matched: pairs.length,
    rmsd,
    covered,
    contextResidues: context.residues.length,
  };
}
