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
| `cnnm2` | CNNM2 Q9H8M5 p.Ser489Cys | UniProt Domain features only (InterPro not read), transmembrane regions |
| `gzf1` | GZF1 Q9H116 p.Arg591Trp | Ten adjacent zinc-finger regions: region-label collisions |
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

Each family declares its size in `FAMILY_SIZE`; the run fails if a family produced a different
number, or if the total differs from `EXPECTED_ASSERTIONS` in `check.mjs` (107).

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

## Running locally

Set `GEOMETRY_BROWSER=/path/to/chrome` if discovery fails. `TRACK_SHOT=1` also writes
`function-track.png`. Running as root (some containers), Chromium needs `--no-sandbox`, which
`check.mjs` does not pass; run as a normal user or add the flag locally.
