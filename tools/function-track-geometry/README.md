# Functional domains schematic geometry check

`npm run test:geometry:function-track` builds this directory with Vite, renders the real
`FunctionTab` in headless Chromium, and reads back assertions the page computed from live SVG and
CSS geometry. It is part of `npm run verify:geometry`, which CI's `geometry` job runs.

jsdom has no layout engine: no `getBBox()`, no computed colour, no `:focus-visible`. Every promise the
schematic makes is one of those, so it is measured here rather than in vitest. The pure layout and
the tab's wording are unit-tested in vitest (`src/components/evidence/function/__tests__`,
`src/components/evidence/__tests__/FunctionTab.test.tsx`).

## Cases

| Case | Fixture | Why |
| --- | --- | --- |
| `nae1` | NAE1 Q13564 p.Asp116Gly, 1010px | The reference variant: InterPro Pfam box, Gene3D segments, PDB secondary structure, four disease variants, a functional region inside the domain |
| `nae1-zoom` | same, "116 ± 50" | Clipped domain box, marks outside the window dropped |
| `nae1-narrow` | same, 380px | Phone width: labels that do not fit are dropped and counted, never overlapped |
| `nae1-dark` | same, `.dark` | Contrast against the dark card |
| `cnnm2` | CNNM2 Q9H8M5 p.Ser489Cys, "Whole protein" pressed | UniProt Domain features only (InterPro not read), three unnamed transmembrane helices numbered by position, no topological domains (bars without rails) |
| `gzf1` | GZF1 Q9H116 p.Arg591Trp, "Whole protein" pressed | Ten adjacent zinc-finger regions: region-label collisions |
| `slc12a4` | SLC12A4 Q9UP95 p.Gln867His, as the tab opens | A 1085 aa transporter opens on 817–917: the overview strip, the helix strip, the inside rail alone, a site label that must flip left at the window's edge |
| `slc12a4-whole` | same, "Whole protein" pressed | Twelve numbered helices and ten topology rails, the helix strip hidden, a domain end number the variant's stem would cross |
| `sod1` | SOD1 P00441 p.Ala5Val, 1010px | The dense case: 81 variants as a bar track (58 residues), 38 point marks in lanes by kind, PROSITE patterns as ticks, the disulfide as a bracket, and the interaction set |
| `sod1-narrow` | same, 380px | Phone width: bars bin two residues, lanes keep their order, labels that do not fit are dropped |
| `crowded` | synthetic | Six sites in eleven residues (tier overflow), a disulfide drawn as its two cysteines, PM1 met |

The NAE1 fixture is shared with the vitest suites (`src/shared/__tests__/fixtures/nae1FunctionalDomains.ts`).
CNNM2 and GZF1 are the real feature tables the earlier track harness used.

## Assertions (per case)

- **marks**: every mark, the variant and every domain box sit at their residues on the backbone's
  measured scale (0.5px), and the case draws the number of marks written in its expectation.
- **labels**: no two labels overlap; no stem or mark crosses a label; every label is inside the
  drawing, and a case expected to drop none drops none.
- **stems**: an upper stem starts on the top edge of what it stands on (domain box or backbone) and
  ends at its head; the variant is the highest mark and its stem crosses the backbone.
- **contrast**: marks reach 3:1 and labels 4.5:1 against the card (WCAG 1.4.11 / 1.4.3).
- **targets**: marks, row buttons and zoom buttons are at least 24×24px (WCAG 2.5.8).
- **focus**: row and zoom buttons show a 2px focus ring under `:focus-visible`.
- **selection**: clicking a mark opens its table row; the row button closes it.
- **verdict**: the PM1 chip reads what the fixture's engine record says.
- **zoom** (`nae1-zoom` only): the window is residue ± 50 and holds only marks inside it.
- **opens** (once per case, before any button is pressed): the tab opens on residue ± 50 above 600
  residues and on the whole protein otherwise. Cases written against the whole-protein drawing press
  "Whole protein" afterwards.
- **view**: the helix / strand strip is drawn only in a window of 300 residues or fewer; a zoomed window
  has an overview strip whose bracket and variant dot sit at their whole-protein scale, a whole-protein
  view has none.
- **membrane** (cases with topology): bars and rails sit at their residues and number what the fixture
  says; the lane sits between the lowest site mark and the axis; the variant's tick crosses it at its
  residue.

Each family declares its size in `FAMILY_SIZE`; the run fails if a family produced a different
number, or if the total differs from `EXPECTED_ASSERTIONS` in `check.mjs` (219). `TRACK_H=12000`
with `TRACK_SHOT=1` makes the screenshot tall enough to show every case.

## Mutation-tested

`node tools/function-track-geometry/mutations.mjs backup`, then `apply <id>`, run the check, then
`restore`. Each mutation below was applied alone and turned the named family red.

| Mutation | Caught by |
| --- | --- |
| `scale-offset` (every x shifted 3px) | marks |
| `tiers-ignored` (labels placed without collision checks) | labels |
| `stem-from-backbone-centre` | stems, labels |
| `query-below-the-pins` | stems |
| `small-hit-target` (12px hit area) | targets |
| `faint-uncited-mark` (30% tint, no outline) | contrast |
| `no-row-focus-ring` | focus |
| `ss-strip-always` (helix strip in any window) | view |
| `membrane-bars-widened` (every helix bar 5px too wide) | membrane |
| `lane-over-the-axis` (axis ignores the topology lane) | membrane, labels |
| `overview-window-off` (overview bracket 8px right) | view |
| `label-never-flips` (a label at the right edge runs off the drawing) | labels |

## Running locally

Set `GEOMETRY_BROWSER=/path/to/chrome` if discovery fails. `TRACK_SHOT=1` also writes
`function-track.png`. Running as root (some containers), Chromium needs `--no-sandbox`, which
`check.mjs` does not pass; run as a normal user or add the flag locally.

## Dense and interaction families (SOD1)

- **dense** (`sod1`): one bar per disease-variant residue with the fixture's count and no disease pins; the variant's own bar
  clay and a 3-variant bar three times a 1-variant bar; point marks in one lane per kind (sites over modifications over
  mutagenesis) with the fixture's counts and no stems; both PROSITE patterns as ticks and the disulfide as one bracket.
- **interact** (`sod1`, runs last because it changes the window): hovering a mark lights its row and the reverse; the
  Disease variants layer toggle hides and restores the bars; the right arrow key selects the first mark and announces it; a
  drag along the axis zooms to the dragged range.

The browser must be focused for the focus-ring assertions (`:focus-visible` does not match in an unfocused tab). Where
`msedge --headless --dump-dom` prints nothing (observed on one Windows machine), serve `dist/` with
`python -m http.server` and read `#geometry-result` from any open page.
