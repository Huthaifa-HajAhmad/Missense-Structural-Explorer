/**
 * server/services/structure/model-contacts.ts — interface contacts read off a model the reader brought.
 *
 * A Boltz-2 model from LocalFold arrives as coordinates and nothing else: no `interfaceContacts`, no
 * ipTM. The tab's predicted-complex rows are built from contacts, so they are measured here instead of
 * being asked of a service that is not in the loop. One definition, used by every imported model:
 *
 *   a contact is one residue pair with at least one heavy-atom pair within 4.5 Å, across chains.
 *
 * 4.5 Å is the usual definition of a residue–residue interface contact (heavy atoms, no hydrogens); it
 * is stated here rather than tuned per protein so two imports are comparable. Only `ATOM` records
 * count: a `HETATM` ligand or a water touching chain A is not a subunit interface, and folding them in
 * would make a predicted complex look better connected than the protein is.
 *
 * ONE ROW PER RESIDUE PAIR, ACROSS COPIES. A homomer's chain B and chain C can each contact the same
 * residue of chain A; the row keeps the nearest of those and the count is residue pairs, not physical
 * atom pairs. `InterfaceContact` has no chain field, so a second row for the same pair on another copy
 * would render as a duplicate the reader cannot tell apart. Imports of a complex the assembly did not
 * plan are refused by the caller, so B here is always the modelled partner.
 *
 * The search is a hash grid over chain A's atoms (cell = the cutoff, so a ±1 sweep cannot miss a pair
 * inside it), which is linear in atoms rather than quadratic in residues. Three bounds keep a public
 * endpoint from being handed a file that costs minutes and gigabytes: `MAX_MODEL_ATOMS` (above any
 * complex this app plans: 4 × 1,085 heavy atoms is ~35,000), `MAX_MODEL_CONTACTS` (a pathological
 * model in which every residue touches every residue), and `MAX_PAIRS_EXAMINED`, which is checked
 * inside the scan because the first two bound the result rather than the work.
 */

import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import type { InterfaceContact } from "../../../src/shared/multimerAssembly.ts";

/** The residue-pair distance that counts as an interface contact, in Ångström. */
export const INTERFACE_CONTACT_CUTOFF = 4.5;

/** Above any complex this app plans, and small enough that a dense file cannot stall the server. */
export const MAX_MODEL_ATOMS = 60_000;

/** A file in which every residue of A touches every residue of B would hold n² rows; refuse it. */
export const MAX_MODEL_CONTACTS = 200_000;

/**
 * How many atom pairs the scan may examine. The caps above bound the RESULT, not the WORK: a file
 * whose coordinates are all at the origin puts every atom in every bucket, so the loop would run for
 * minutes before a result cap ever tripped. Measured on a 4 × 1,085 model with zeroed coordinates,
 * the scan without any work bound blocked the Node event loop for five minutes — on an
 * unauthenticated route. A real fold of the largest complex this app plans (~35,000 atoms) examines
 * tens of millions, so this leaves an order of magnitude of headroom while stopping a pathological
 * file in seconds.
 */
export const MAX_PAIRS_EXAMINED = 300_000_000;

/**
 * The most heavy atoms one 4.5 Å grid cell can hold. A folded protein never puts more than a few
 * hundred there (a 4.5 Å cube holds roughly one to two residues); far more means superimposed or
 * zeroed coordinates, which is refused before the scan starts rather than after it.
 */
export const MAX_CELL_ATOMS = 512;

function superimposed(cutoff: number): Error {
  return new Error(
    `That model's atoms are superimposed: more than ${MAX_CELL_ATOMS} heavy atoms sit inside a single ` +
    `${cutoff} Å cell. Check that the file holds folded coordinates and not a zeroed or unminimised structure.`
  );
}

export interface ImportedModelContacts {
  /** Polymer chains in the file, A first when present, otherwise alphabetical. */
  chainIds: string[];
  /** Residue numbers per chain, sorted — what the variant's own chain is checked against. */
  residuesByChain: Record<string, number[]>;
  /** Three-letter residue name per chain and number, for the construct check on chain A. */
  residueNames: Record<string, Record<number, string>>;
  /** `resA` on chain A, `resB` on the partner, `distance` the closest heavy-atom pair. */
  contacts: InterfaceContact[];
}

type Atom = { resSeq: number; resName: string; chain: string; x: number; y: number; z: number };

/** Heavy atoms of the polymer, chain included; hydrogens and `HETATM` records are left out. */
function polymerAtoms(pdbText: string): { atoms: Atom[]; atomRecords: number } {
  const atoms: Atom[] = [];
  let atomRecords = 0;
  for (const line of pdbText.split(/\r?\n/)) {
    if (!line.startsWith("ATOM")) continue;
    atomRecords += 1;
    const altLoc = line.charAt(16);
    // LocalFold (and AlphaFold 3) write no altlocs; a file with one keeps its first conformer only,
    // never both, because both would double-count the same atom.
    if (altLoc !== " " && altLoc !== "" && altLoc !== "A") continue;
    const element = line.slice(76, 78).trim().toUpperCase();
    // Without an element column the name is all there is: `1HG2` and `HG` are hydrogens, `HG` as an
    // element would be mercury, which is never an ATOM record.
    const heavy = element ? element !== "H" : !/^\d*H/.test(line.slice(12, 16).trim().toUpperCase());
    if (!heavy) continue;
    const chain = line.slice(21, 22).trim();
    const resName = line.slice(17, 20).trim().toUpperCase();
    const resSeq = Number.parseInt(line.slice(22, 26).trim(), 10);
    const x = Number.parseFloat(line.slice(30, 38));
    const y = Number.parseFloat(line.slice(38, 46));
    const z = Number.parseFloat(line.slice(46, 54));
    if (!chain || !Number.isInteger(resSeq) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    atoms.push({ resSeq, resName, chain, x, y, z });
  }
  return { atoms, atomRecords };
}

/** Chain ids, A first, then a stable byte order (locale-free: these are chain letters, not words). */
function orderChains(chainIds: string[]): string[] {
  return chainIds.sort((left, right) =>
    left === right ? 0 : left === "A" ? -1 : right === "A" ? 1 : left < right ? -1 : 1
  );
}

/**
 * Every residue contact between chain A and each other chain of an imported model.
 *
 * @throws when the file holds no usable coordinates or is too large, so the caller can say what is
 *         wrong with the file rather than render an empty interface as "no contacts".
 */
export function interfaceContactsFromPdb(
  pdbText: string,
  { cutoff = INTERFACE_CONTACT_CUTOFF }: { cutoff?: number } = {}
): ImportedModelContacts {
  if (/^\s*data_/m.test(pdbText)) {
    throw new Error("That file is mmCIF. LocalFold saves PDB too — use the PDB download, or paste PDB text.");
  }
  const { atoms, atomRecords } = polymerAtoms(pdbText);
  if (atoms.length === 0) {
    throw new Error(atomRecords > 0
      ? "That file's ATOM records carry no chain identifier, so nothing can be told apart as chain A and a partner."
      : "That file holds no protein coordinates (no ATOM records), so there is no interface to read.");
  }
  if (atoms.length > MAX_MODEL_ATOMS) {
    throw new Error(
      `That model holds ${atoms.length.toLocaleString("en-GB")} atoms; this reader takes up to ` +
      `${MAX_MODEL_ATOMS.toLocaleString("en-GB")}. Fold only the chains of this assembly, not a whole entry.`
    );
  }
  const chainIds = orderChains([...new Set(atoms.map(a => a.chain))]);
  const residuesByChain: Record<string, number[]> = {};
  const residueNames: Record<string, Record<number, string>> = {};
  for (const chain of chainIds) {
    const chainAtoms = atoms.filter(a => a.chain === chain);
    residuesByChain[chain] = [...new Set(chainAtoms.map(a => a.resSeq))].sort((a, b) => a - b);
    const names: Record<number, string> = {};
    for (const atom of chainAtoms) names[atom.resSeq] ??= atom.resName;
    residueNames[chain] = names;
  }
  if (!chainIds.includes("A")) {
    throw new Error(`That file has no chain A (it has ${chainIds.join(", ")}), and chain A is the one that carries the variant.`);
  }
  // A one-chain file is not refused here: the caller knows which chains the assembly folds, and its
  // message — "this assembly folds A and B" — is more use than "one chain". Contacts are simply empty.

  // A hash grid over chain A's atoms, so each partner atom tests only its own neighbourhood.
  const cell = (value: number) => Math.floor(value / cutoff);
  const grid = new Map<string, Atom[]>();
  const chainAtoms = atoms.filter(a => a.chain === "A");
  for (const atom of chainAtoms) {
    const key = `${cell(atom.x)},${cell(atom.y)},${cell(atom.z)}`;
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(atom);
      if (bucket.length > MAX_CELL_ATOMS) throw superimposed(cutoff);
    } else grid.set(key, [atom]);
  }

  // One row per residue pair, nearest distance kept; a residue pair is a contact if any of its atoms are.
  const nearest = new Map<string, { resA: number; resB: number; distance: number }>();
  const cutoffSquared = cutoff * cutoff;
  let examined = 0;
  for (const atom of atoms) {
    if (atom.chain === "A") continue;
    const cx = cell(atom.x);
    const cy = cell(atom.y);
    const cz = cell(atom.z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const other of bucket) {
            examined += 1;
            // Bounded INSIDE the loop: a result cap checked afterwards is a cap on memory, not time.
            if (examined > MAX_PAIRS_EXAMINED) {
              throw new Error(
                `That model's atoms are superimposed: this reader stopped after examining ` +
                `${MAX_PAIRS_EXAMINED.toLocaleString("en-GB")} atom pairs inside ${cutoff} Å. ` +
                `Check that the file holds folded coordinates and not an unminimised or zeroed structure.`
              );
            }            const ddx = other.x - atom.x;
            const ddy = other.y - atom.y;
            const ddz = other.z - atom.z;
            const squared = ddx * ddx + ddy * ddy + ddz * ddz;
            if (squared > cutoffSquared) continue;
            const key = `${other.resSeq}:${atom.resSeq}`;
            const distance = Math.sqrt(squared);
            const current = nearest.get(key);
            if (current === undefined || distance < current.distance) {
              nearest.set(key, { resA: other.resSeq, resB: atom.resSeq, distance });
              if (nearest.size > MAX_MODEL_CONTACTS) {
                throw new Error(
                  `That model has more than ${MAX_MODEL_CONTACTS.toLocaleString("en-GB")} interface residue pairs; ` +
                  `this reader does not score a file whose every residue touches every other. ` +
                  `Check that it holds folded coordinates and not a lattice.`
                );
              }
            }
          }
        }
      }
    }
  }


  const contacts = [...nearest.values()]
    .map(c => ({ resA: c.resA, resB: c.resB, distance: Math.round(c.distance * 100) / 100 }))
    .sort((a, b) => a.resA - b.resA || a.resB - b.resB);
  return { chainIds, residuesByChain, residueNames, contacts };
}

/**
 * The three-letter code of the residue in `chain` at `resSeq`, or null. Used to check that chain A is
 * the construct the job asked for (a PDB of another protein numbered 1..N would otherwise pass on
 * numbering alone).
 */
export function residueNameAt(
  model: Pick<ImportedModelContacts, "residueNames">,
  chain: string,
  resSeq: number
): string | null {
  const name = model.residueNames[chain]?.[resSeq];
  return name ?? null;
}

/** The one-letter code a three-letter name stands for, uppercased, or null when it is not a residue. */
export function oneLetterOf(threeLetter: string | null): string | null {
  if (threeLetter === null) return null;
  return AMINO_ACID_3_TO_1[threeLetter.toUpperCase()] ?? null;
}
