/**
 * src/shared/multimerHandoff.ts — the job file that moves a complex fold into the reader's browser.
 *
 * WHY A FILE AND NOT A REQUEST. localfold.org has no API: Boltz-2 is compiled to WebGPU and runs in the
 * page, so "use LocalFold instead of a provider" can only mean handing the job over and reading the
 * model back. The format is AlphaFold 3's own open-source job JSON, in the dialect LocalFold's job
 * loader reads (`web/job-json.js` there): `sequences` entries keyed `protein`, an `id` LIST whose
 * LENGTH is the copy count, integer seeds, and `dialect: "alphafold3"` with a version it knows. The
 * server dialect is the other dialect and cannot express two chains that differ by one residue, which
 * is exactly what a variant complex is — so this file is written open.
 *
 * WHY THE SIZE IS PART OF THE PAYLOAD. A browser fold's memory grows with the square of the token
 * count (their own benchmarks put a 1530-token fold at ~9.6 GB of device memory). A 2 × 1085 complex
 * cannot finish on a visitor's GPU however long they wait, and saying so before they start is the
 * difference between "your browser gave up" and a stated limit. `tooLarge` never refuses the hand-off:
 * the reader may have the hardware, and a false refusal is its own lie.
 */

import type { MultimerHandoff } from "./contracts.ts";

/** localfold.org, with Boltz-2 already selected (`?model=boltz2` is the page's own parameter). */
export const LOCALFOLD_URL = "https://localfold.org/?model=boltz2";

/**
 * How long either hand-off request may take. Both re-read the assembly (UniProt, then PDBe) before
 * answering, and the import then measures contacts, so a short budget would fail on a slow upstream
 * rather than on this feature. It lives with the feature because it bounds these two calls and
 * nothing else.
 */
export const CLIENT_LOCALFOLD_REQUEST_BUDGET_MS = 90_000;

/**
 * Total residues past which a browser fold is not expected to finish.
 *
 * Read off LocalFold's published behaviour rather than guessed: a few hundred residues is a fold of
 * seconds, and their benchmark tables show a multi-thousand-token complex needing a tensor of device
 * memory in the tens of gigabytes — the pair representation grows with the square of the token count.
 * 800 keeps a homodimer of ~400-residue subunits inside a mainstream discrete GPU's budget while
 * staying only a modest extrapolation. It is a warning, never a gate (`tooLarge`).
 */
export const LOCALFOLD_MAX_RESIDUES = 800;

/**
 * The most a PDB text may weigh. Kept equal to the route's schema cap (8 MB, inside the 10 MB body
 * parser), so the reader is told by the picker instead of after uploading.
 */
export const LOCALFOLD_MAX_UPLOAD_BYTES = 8_000_000;

/**
 * What the reader is told before the tab opens. Three limits decide whether this works at all, and
 * all three are stated: a WebGPU browser, a one-off weights download, and the alignment search —
 * LocalFold itself runs offline, but its default MSA asks the public ColabFold server for an
 * alignment. Switch that dial to Single Sequence and nothing leaves the machine.
 */
export const LOCALFOLD_EGRESS_NOTE =
  "LocalFold needs a WebGPU browser (Chrome or Edge 113+, Safari 18+) and downloads its model weights " +
  "once, cached by the browser. It folds on your own GPU; its default MSA search sends the sequence to " +
  "api.colabfold.com, so choose Single Sequence there to keep everything local.";

/**
 * The AlphaFold 3 job LocalFold folds, from the chains the server already planned.
 *
 * @param chains in fold order; `A` carries the variant. Two chains that differ by one residue must
 *               stay two entries — merging them into one with `count: 2` would fold the wild type
 *               twice and silently drop the variant.
 */
export function buildLocalFoldJobJson(
  name: string,
  chains: ReadonlyArray<{ id: string; sequence: string }>
): string {
  const job = [{
    name,
    // An integer in this dialect; the server dialect is the one that wants strings.
    modelSeeds: [0],
    sequences: chains.map(chain => ({ protein: { id: [chain.id], sequence: chain.sequence } })),
    // Both keys or neither: a job with one of them is refused by LocalFold's reader as malformed.
    dialect: "alphafold3",
    version: 2,
  }];
  return `${JSON.stringify(job, null, 2)}\n`;
}

/** The hand-off for these chains, with the size that decides whether a browser can hold it. */
export function localFoldHandoff(
  name: string,
  chains: ReadonlyArray<{ id: string; sequence: string }>
): MultimerHandoff {
  const residues = chains.reduce((total, chain) => total + chain.sequence.length, 0);
  return {
    url: LOCALFOLD_URL,
    filename: `${name.replace(/[^A-Za-z0-9]+/g, "_")}_localFold_job.json`,
    jobJson: buildLocalFoldJobJson(name, chains),
    residues,
    tooLarge: residues > LOCALFOLD_MAX_RESIDUES,
  };
}
