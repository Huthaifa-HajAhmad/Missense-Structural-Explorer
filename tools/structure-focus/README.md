# 3D residue-focus check

`npm run test:geometry:focus` builds this directory with Vite, renders the real `MolstarViewer` against the real
AlphaFold DB model for SOD1 (P00441, model_v6) in headless Chromium with WebGL, and reads back assertions the page
computed after Mol\* finished drawing. The build inlines the coordinates, so the run makes no network request.

## Why a browser

"Show both cysteines in 3D" and "Show interface in 3D" promise that the canvas draws a **residue set**, not just the
variant residue. Each layer under that promise — the caption, the store action, the prop, the Mol\* structure
component, the atoms it resolves — can be individually correct while the canvas still draws one residue, and a vitest
assertion passes, because jsdom has no WebGL and no plugin: it can only see that `companionResidues` was passed.

The viewer writes back what it actually built, on the element Mol\* renders into:

| Attribute | Meaning |
| --- | --- |
| `data-companion-residues` | How many companion residues the last draw was given. Absent when none. |
| `data-companion-atoms` | How many atoms Mol\* resolved from them. **0 means the numbers address nothing in this model** — a highlight that silently draws nothing. |

`data-focus-count` on the caption (`[data-testid="structure-residue-focus"]`) carries the same count, so a caption
that describes a set the canvas never received fails too.

## Cases

| Case | Focus | Why |
| --- | --- | --- |
| nothing selected | — | The canvas must not carry a stale companion set from a previous selection. |
| disulfide | 58 + [147] | UniProt records Cys58–Cys147 in SOD1; the real model has both, so the partner cysteine must resolve to atoms (6 in the SH2 run) and both must be labelled. |
| interface | 5 + [50–54] | A five-residue patch, larger than the four-residue label limit: it must still draw, without labels. |
| cleared | — | Clearing the highlight must remove both the caption and the counts, not leave the last claim standing. |

The fixture is downloaded, not drawn: `sod1-afdb.pdb` is the AlphaFold DB monomer model, whose `TITLE ... ALPHAFOLD`
line is what makes the canvas treat the numbering as UniProt numbering (and therefore able to address residue 5 at all).

## Running it

    npm run test:geometry:focus              # assertions only
    FOCUS_SHOT=1 npm run test:geometry:focus # also writes structure-focus.png

Set `GEOMETRY_BROWSER` / `CHROME_PATH` to override browser discovery.

**Not part of `npm run verify`.** It is the only harness here that needs WebGL2, and the CI runner has no GPU: Chrome
reaches software WebGL through `--enable-unsafe-swiftshader`, which is the flag passed above, but gating a deploy on
that has not been proven on the runner. Run it locally, and run it by hand when touching `residueFocus.ts`,
`useMolstarStructure.ts` or the caption in `MolstarViewer.tsx`. Promoting it into `verify:geometry` is a one-line
change once a CI run has shown SwiftShader works there.
