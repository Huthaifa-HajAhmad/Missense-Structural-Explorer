# Connected workspace review

Run `npx vite --host 127.0.0.1 --port 5182`, then open
`http://127.0.0.1:5182/tools/exploration-preview/index.html`.
For a stable review during concurrent file changes, set `DISABLE_HMR=true` before starting Vite.

This mounts the production `AppViews`, Landscape, Mol* and inspector. All coordinates are synthetic
helical stand-ins; scores use existing SOD1 layout fixtures. No live analysis is run. The geometry,
pLDDT and provenance labels are test inputs, not scientific evidence.

Review flow:

1. Open Focus residue, select V8, then Inspect in 3D. Selection reads VAL 8; variant measurements stay A5V.
2. Focus the selected residue; hover previews and clicking pins only mapped protein residues.
3. Choose ESMFold, return to Landscape, then return to 3D. The family, Landscape tab and selection persist.
4. Missing residue fixture selects 30, deliberately omitted from the coordinates. Selection stays pinned.
5. Unmapped entry fixture exercises author numbering in the AlphaFold view. No protein selection is propagated.
6. Check light/dark, 1440/760/390px widths, keyboard model navigation, inspector resize and collapse.

Reload resets the fixture. Literature requests are blocked along with all other live APIs.

See `doc/EXPLORATION_WORKSPACE.md` for the production component and state contracts.
